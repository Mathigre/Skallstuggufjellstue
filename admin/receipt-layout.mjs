// Reassemble sparse OCR words into geometric rows before parsing receipt tables.
export function receiptLines(blocks){
 const words=(blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[])))
 .filter(w=>w.text?.trim()&&w.bbox&&w.bbox.y1>w.bbox.y0)
 .sort((a,b)=>(a.bbox.y0+a.bbox.y1)-(b.bbox.y0+b.bbox.y1));
 const rows=[];
 for(const word of words){
 const box=word.bbox,cy=(box.y0+box.y1)/2,height=box.y1-box.y0;
 const row=rows.find(r=>Math.abs(r.cy-cy)<Math.min(r.height,height)*.45);
 if(row){row.words.push(word);row.cy=row.words.reduce((s,w)=>s+(w.bbox.y0+w.bbox.y1)/2,0)/row.words.length;}
 else rows.push({cy,height,words:[word]});
 }
 return rows.sort((a,b)=>a.cy-b.cy).map(r=>r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>w.text.trim()).join(' ')).join('\n');
}
