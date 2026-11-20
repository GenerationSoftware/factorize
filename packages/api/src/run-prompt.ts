/** Bounded encrypted list projection; the full accepted input remains separate. */
export function runPromptPreview(text:string){const characters=Array.from(text.replace(/\s+/g," ").trim());return characters.length>240?characters.slice(0,240).join("")+"…":characters.join("");}
