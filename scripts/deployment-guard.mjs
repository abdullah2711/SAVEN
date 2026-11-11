// This iteration is authorized for testing-1 only. Wrangler invokes this build
// guard even if the Cloudflare dashboard has no separate npm build command.
const branch=process.env.WORKERS_CI_BRANCH??process.env.CF_PAGES_BRANCH;
if(branch && branch!=='testing-1') {
  console.error('This foundation is testing-only. Deployment from this branch is blocked until a reviewed release configuration is committed.');
  process.exit(1);
}
console.log('SAVEN testing build guard passed.');
