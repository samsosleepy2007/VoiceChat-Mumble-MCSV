(()=>{
 const body=document.body,stage=document.createElement('div');stage.className='viewport-stage';
 // Keep overlays outside the scaled page so fixed payment and native dialogs stay viewport sized.
 for(const node of [...body.children])if(node.matches('header, main.page, footer, #auth-notice'))stage.append(node);
 body.prepend(stage);body.classList.add('viewport-fit');
 let frame=0;
 function fit(){frame=0;const viewport=window.visualViewport,width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;if(!width||!height)return;const ratio=Math.min(1,(height-8)/stage.offsetHeight,(width-8)/stage.scrollWidth);stage.style.transform='scale('+Math.max(.1,ratio)+')';}
 function schedule(){if(!frame)frame=requestAnimationFrame(fit);}
 if(window.ResizeObserver)new ResizeObserver(schedule).observe(stage);
 new MutationObserver(schedule).observe(stage,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class','aria-invalid']});
 window.addEventListener('resize',schedule);window.addEventListener('pageshow',schedule);window.visualViewport?.addEventListener('resize',schedule);document.fonts?.ready.then(schedule);fit();
})();
