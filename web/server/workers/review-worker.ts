// Review worker: runs the reviewer agent to check code quality

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { BUDGETS, MAX_FIX_CYCLES } from '../config.js';
import { runAgentJob } from './base-worker.js';
import { setSprintStatus, getSprintDir, sprintNeedsApproval } from '../services/state-service.js';
import { enqueuePrCreation, enqueueFixCycle } from '../queues/queue-manager.js';
import { requestApproval } from '../services/approval-gate.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('review-worker');

export interface ReviewFinding {
  id: string;
  category: 'must-fix' | 'should-fix' | 'nitpick';
  location: string;
  description: string;
}

interface ReviewJobData {
  sprintId: string;
  cycle: number;
  targetDir: string;
}

/** Parse review markdown into structured findings. */
function parseFindings(sprintId: string, cycle: number): ReviewFinding[] {
  const reviewFile = path.join(getSprintDir(sprintId), `review-${cycle}.md`);
  if (!fs.existsSync(reviewFile)) return [];

  const content = fs.readFileSync(reviewFile, 'utf-8');
  const findings: ReviewFinding[] = [];

  // Split content into category sections
  const categoryPatterns: { pattern: RegExp; category: ReviewFinding['category'] }[] = [
    { pattern: /###\s*MUST[- ]FIX/i, category: 'must-fix' },
    { pattern: /###\s*SHOULD[- ]FIX/i, category: 'should-fix' },
    { pattern: /###\s*NITPICK/i, category: 'nitpick' },
  ];

  // Find the start index of each category section
  const sections: { category: ReviewFinding['category']; start: number }[] = [];
  for (const { pattern, category } of categoryPatterns) {
    const match = content.match(pattern);
    if (match && match.index !== undefined) {
      sections.push({ category, start: match.index });
    }
  }
  sections.sort((a, b) => a.start - b.start);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const end = i + 1 < sections.length ? sections[i + 1].start : content.length;
    const sectionText = content.slice(section.start, end);

    // Extract checklist items: - [ ] **location** — description  OR  - [ ] **location**: description
    const itemRegex = /- \[[ x]?\]\s*\*\*(.+?)\*\*\s*[—–:-]\s*(.+)/g;
    let match;
    let idx = 0;
    while ((match = itemRegex.exec(sectionText)) !== null) {
      findings.push({
        id: `${section.category}-${idx}`,
        category: section.category,
        location: match[1].trim(),
        description: match[2].trim(),
      });
      idx++;
    }
  }

  log.info(`Parsed ${findings.length} findings from review-${cycle}.md`, {
    'must-fix': findings.filter(f => f.category === 'must-fix').length,
    'should-fix': findings.filter(f => f.category === 'should-fix').length,
    'nitpick': findings.filter(f => f.category === 'nitpick').length,
  });

  return findings;
}

/** Build a text summary of selected findings for the fix agent prompt. */
function buildFindingsText(findings: ReviewFinding[]): string {
  const grouped: Record<string, ReviewFinding[]> = {};
  for (const f of findings) {
    (grouped[f.category] ||= []).push(f);
  }

  const lines: string[] = [];
  for (const category of ['must-fix', 'should-fix', 'nitpick'] as const) {
    const items = grouped[category];
    if (!items?.length) continue;
    lines.push(`### ${category.toUpperCase()}`);
    for (const item of items) {
      lines.push(`- [ ] **${item.location}** — ${item.description}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Fallback: parse verdict from text when JSON verdict file is missing or malformed */
function fallbackTextParsing(output: string, sprintId: string, cycle: number): boolean {
  const reviewFile = path.join(getSprintDir(sprintId), `review-${cycle}.md`);
  const reviewContent = fs.existsSync(reviewFile) ? fs.readFileSync(reviewFile, 'utf-8') : output;
  const combined = reviewContent + '\n' + output;
  const upper = combined.toUpperCase();

  const hasRequestChanges = upper.includes('REQUEST_CHANGES') || upper.includes('REQUEST CHANGES');
  const hasApproval = upper.includes('APPROVE');
  const approved = hasApproval && !hasRequestChanges;
  log.info(`Review cycle ${cycle} fallback verdict: approved=${approved} (hasApproval=${hasApproval}, hasRequestChanges=${hasRequestChanges})`);
  return approved;
}

export function startReviewWorker(): Worker {
  const connection = getRedisConnection();

  const worker = new Worker('review', async (job: Job<ReviewJobData>) => {
    const { sprintId, cycle, targetDir } = job.data;
    log.info(`Starting review cycle ${cycle} for ${sprintId}`);

    broadcast({ type: 'review:update', sprintId, cycle, status: 'reviewing' });

    const researchFile = path.join(getSprintDir(sprintId), 'research.md');
    const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf-8') : '';
    const planFile = path.join(getSprintDir(sprintId), 'plan.json');
    const planContent = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf-8') : '';

    const reviewFilePath = path.join(getSprintDir(sprintId), `review-${cycle}.md`);
    const verdictFilePath = path.join(getSprintDir(sprintId), `review-${cycle}-verdict.json`);

    const prompt = `You are the code reviewer for sprint ${sprintId}, review cycle ${cycle}.

Codebase Research:
${research}

Sprint Plan:
${planContent}

Working directory: ${targetDir}

Instructions:
1. Review the git diff for this sprint
2. Run linting and tests
3. Categorize findings as MUST-FIX, SHOULD-FIX, or NITPICK
4. Write your markdown review to: ${reviewFilePath}
5. CRITICAL: You MUST also write a machine-readable verdict JSON file to: ${verdictFilePath}

The verdict JSON file must contain exactly this structure:
{
  "verdict": "APPROVE" or "REQUEST_CHANGES",
  "must_fix_count": <number of MUST-FIX issues>,
  "should_fix_count": <number of SHOULD-FIX issues>,
  "nitpick_count": <number of NITPICK issues>,
  "summary": "<brief one-line summary>"
}

Rules for the verdict:
- Use "APPROVE" when there are zero MUST-FIX items and all tests pass
- Use "REQUEST_CHANGES" when there are MUST-FIX items or tests fail
- The JSON file is how the system determines the outcome — you MUST write it`;

    const result = await runAgentJob(job, 'reviewer', prompt, {
      budget: String(BUDGETS.review),
      taskId: `review-${cycle}`,
      cwd: targetDir,
    });

    // Determine verdict from structured JSON file (primary) or fallback to text parsing
    let isApproved = false;

    if (fs.existsSync(verdictFilePath)) {
      try {
        const verdictData = JSON.parse(fs.readFileSync(verdictFilePath, 'utf-8'));
        isApproved = verdictData.verdict === 'APPROVE';
        log.info(`Review cycle ${cycle} verdict from JSON: verdict=${verdictData.verdict}, must_fix=${verdictData.must_fix_count}, approved=${isApproved}`);
      } catch (err) {
        log.warn(`Failed to parse verdict JSON for cycle ${cycle}, falling back to text parsing: ${err}`);
        isApproved = fallbackTextParsing(result.output, sprintId, cycle);
      }
    } else {
      log.warn(`No verdict JSON found for cycle ${cycle}, falling back to text parsing`);
      isApproved = fallbackTextParsing(result.output, sprintId, cycle);
    }

    if (isApproved) {
      broadcast({ type: 'review:update', sprintId, cycle, status: 'approved' });

      // Gate: require approval before PR creation
      if (sprintNeedsApproval(sprintId, 'pr')) {
        log.info(`Requesting approval before PR creation for ${sprintId}`);
        const prApproval = await requestApproval(
          sprintId,
          'pr-creation',
          `Review passed (cycle ${cycle}). Approve to create the pull request?`,
          { cycle, verdict: 'approved' },
        );
        if (!prApproval.approved) {
          log.info(`PR creation rejected for ${sprintId}`);
          setSprintStatus(sprintId, 'failed');
          broadcast({ type: 'sprint:status', sprintId, status: 'failed' });
          return { success: true, approved: isApproved, duration: result.durationSeconds };
        }
      }

      setSprintStatus(sprintId, 'pr-created');
      await enqueuePrCreation(sprintId);
    } else if (cycle < MAX_FIX_CYCLES) {
      broadcast({ type: 'review:update', sprintId, cycle, status: 'needs-fixes' });

      const findings = parseFindings(sprintId, cycle);

      if (findings.length > 0 && sprintNeedsApproval(sprintId, 'task')) {
        log.info(`Requesting fix-cycle approval for ${sprintId} with ${findings.length} findings`);
        const fixApproval = await requestApproval(
          sprintId,
          `fix-cycle-${cycle}`,
          `Review cycle ${cycle} found ${findings.length} issue${findings.length === 1 ? '' : 's'}.`,
          { findings },
        );

        if (!fixApproval.approved) {
          log.info(`Fix cycle rejected for ${sprintId}`);
          setSprintStatus(sprintId, 'failed');
          broadcast({ type: 'sprint:status', sprintId, status: 'failed' });
          return { success: true, approved: isApproved, duration: result.durationSeconds };
        }

        // Filter to only selected findings
        const selectedIds = (fixApproval.data as { selectedIds?: string[] })?.selectedIds;
        const selectedFindings = selectedIds
          ? findings.filter(f => selectedIds.includes(f.id))
          : findings;
        const filteredText = buildFindingsText(selectedFindings);
        log.info(`Fix cycle approved with ${selectedFindings.length}/${findings.length} findings selected`);
        await enqueueFixCycle(sprintId, cycle, filteredText || result.output);
      } else {
        log.info(`Review cycle ${cycle} needs fixes, enqueuing fix job`);
        await enqueueFixCycle(sprintId, cycle, result.output);
      }
    } else {
      broadcast({ type: 'review:update', sprintId, cycle, status: 'max-cycles-reached' });
      setSprintStatus(sprintId, 'failed');
      broadcast({ type: 'sprint:status', sprintId, status: 'failed' });
      log.warn(`Max review cycles reached for ${sprintId}, marking as failed`);
    }

    return { success: true, approved: isApproved, duration: result.durationSeconds };
  }, {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    log.error(`Review job failed: ${err.message}`, { jobId: job?.id });
    if (job) {
      const { sprintId } = job.data as ReviewJobData;
      setSprintStatus(sprintId, 'failed');
      broadcast({ type: 'sprint:status', sprintId, status: 'failed' });
      broadcast({ type: 'error', sprintId, message: `Review failed: ${err.message}` });
    }
  });

  log.info('Review worker started');
  return worker;
}
