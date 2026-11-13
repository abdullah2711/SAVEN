// Input is supplied through stdin from a protected file, never CLI arguments.
import {NativeRuntime} from '../src/local/runtime.mjs';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)throw Error('Bootstrap input too large');}
const data=JSON.parse(input),runtime=new NativeRuntime(process.env.SAVEN_DATA_DIR);
try{const userId=await runtime.bootstrap(data.email,data.password);console.log(JSON.stringify({initialized:true,userId}));}finally{runtime.close();}
