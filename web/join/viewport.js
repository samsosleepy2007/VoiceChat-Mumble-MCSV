(()=>{
 const body=document.body,stage=document.createElement('div');stage.className='viewport-stage';
 // Keep overlays outside the scaled page so fixed payment and native dialogs stay viewport sized.
 for(const node of [...body.children])if(node.matches('header, main.page, footer, #auth-notice'))stage.append(node);
 body.prepend(stage);body.classList.add('viewport-fit');
 // While typing, the on-screen keyboard shrinks the visual viewport to about half the screen. Scaling to
 // that would make the page tiny, so keep the scale from before the keyboard opened, let the page scroll,
 // and bring the focused field into view instead.
 const editable='textarea,select,[contenteditable=""],[contenteditable="true"],input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]):not([type=image])';
 const typing=()=>{const active=document.activeElement;return Boolean(active&&active!==body&&stage.contains(active)&&active.matches(editable));};
 let frame=0,roomy=0,roomyWidth=0;
 function fit(){
  frame=0;const viewport=window.visualViewport,width=viewport?.width||window.innerWidth,live=viewport?.height||window.innerHeight;if(!width||!live)return;
  const editing=typing();body.classList.toggle('typing',editing);
  // Remember the height without the keyboard; a width change (rotation) makes the old value stale.
  if(!editing||!roomy||Math.abs(width-roomyWidth)>1){roomy=live;roomyWidth=width;}
  const height=editing?Math.max(roomy,live):live;
  const ratio=Math.min(1,(height-8)/stage.offsetHeight,(width-8)/stage.scrollWidth);stage.style.transform='scale('+Math.max(.1,ratio)+')';
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(fit);}
 function reveal(){const active=document.activeElement;if(typing())active.scrollIntoView({block:'center',behavior:'smooth'});}
 if(window.ResizeObserver)new ResizeObserver(schedule).observe(stage);
 new MutationObserver(schedule).observe(stage,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class','aria-invalid']});
 stage.addEventListener('focusin',()=>{schedule();setTimeout(reveal,350);});
 stage.addEventListener('focusout',()=>setTimeout(schedule,50));
 window.addEventListener('resize',schedule);window.addEventListener('pageshow',schedule);window.visualViewport?.addEventListener('resize',()=>{schedule();if(typing())setTimeout(reveal,50);});document.fonts?.ready.then(schedule);fit();
})();
