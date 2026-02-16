# Dev Team Enhancements for Version 2

Let’s make some enhancements to our Dev Team.

We want a way to visually see status and progress.

We want to support more than one implementer working at a time.

## Visually See Status and Progress

Instead of the dev team being a set of shell scripts and markdown, let’s add a web app written in node using TypeScript that will be run locally.

When planning a sprint from a spec, open a browser and go to the page for planning a sprint and show that it is working.  When the generated plan is ready show in the browser and interact with the user through the browser like it would in CLI.

Support approving the sprint and then move to a page that shows the sprint status and progress.

Support interactions in the browser like what was done in CLI.

## Support Multiple Implementers

Support more than one implementer.  Default to 2 implementers unless asked to add more.

In order to do this, have the planner distribute tasks to the implementers to avoid dependencies between their tasks where possible and minimize where they need to modify the same files.  

Change how tasks are distributed and tracked locally by using [bullmq.io](http://bullmq.io) to communicate between agent roles from the local node web server.

In the browser represent the implementers by giving each of them a name and an avatar.  

