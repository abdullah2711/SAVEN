export function createNavigation({restore,onChange=()=>{},limit=100}){
 let entries=[],index=-1,restoring=false;
 const state=()=>({canBack:index>0,canForward:index>=0&&index<entries.length-1});
 function record(snapshot){if(restoring)return;const next=structuredClone(snapshot);if(index>=0&&JSON.stringify(next)===JSON.stringify(entries[index]))return;entries=entries.slice(0,index+1);entries.push(next);if(entries.length>limit)entries.shift();index=entries.length-1;onChange(state());}
 async function move(delta){const target=index+delta;if(restoring||target<0||target>=entries.length)return false;restoring=true;try{await restore(structuredClone(entries[target]));index=target;return true;}finally{restoring=false;onChange(state());}}
 function reset(){entries=[];index=-1;onChange(state());}
 return {record,back:()=>move(-1),forward:()=>move(1),reset,state};
}
