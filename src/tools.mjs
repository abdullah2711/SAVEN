import { AppError } from './errors.mjs';
import { preview,submit } from './commands.mjs';

// A model receives only this bounded catalog. Actor and company scope come from
// the authenticated server task, never from a tool argument or uploaded file.
export const tools=[
  {name:'accounting.preview',description:'Validate a proposed service invoice or whole-unit stock issue and return its accounting effects.'},
  {name:'accounting.submit',description:'Submit the reviewed preview to the configured human approval queue. Does not post.'}
];
export async function executeTool(name,input,{db,actor,companyId,idempotencyKey}) {
  if(name==='accounting.preview')return preview(db,actor,companyId,input);
  if(name==='accounting.submit')return submit(db,actor,companyId,input,idempotencyKey);
  throw new AppError(403,'TOOL_NOT_ALLOWED','This agent tool is not available.');
}
