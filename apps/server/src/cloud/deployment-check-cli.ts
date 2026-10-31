import { checkDeployment, DeploymentCheckFailure, type DeploymentCheckMode } from './deployment-check.js';

const modes: Record<string, DeploymentCheckMode> = {
  '--config-only': 'config', '--before-migrations': 'before-migrations', '--ready': 'ready',
};
try {
  const args = process.argv.slice(2), selected = args.filter(arg => arg in modes);
  if (selected.length !== 1 || args.some(arg => !(arg in modes) && arg !== '--local-test'))
    throw new DeploymentCheckFailure('arguments: choose --config-only, --before-migrations, or --ready');
  console.log(JSON.stringify(await checkDeployment(process.env, modes[selected[0]!]!, args.includes('--local-test'))));
} catch (error) {
  console.error(JSON.stringify({
    result: 'FAIL', stage: error instanceof DeploymentCheckFailure ? error.stage : 'configuration',
    details: 'Redacted. See docs/cloud-provider-deployment.md; no repair was attempted.',
    renderHttpsWorkflow: 'NOT RUN',
  }));
  process.exitCode = 1;
}
