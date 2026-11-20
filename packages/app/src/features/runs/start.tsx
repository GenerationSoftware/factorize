import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Label, Select, Textarea } from "../../shared/ui";
import { skillsQuery } from "../skills/queries";
import { messageOf } from "../auth/session";

export function StartRun() {
  const [open, setOpen] = useState(false),
    [skill, setSkill] = useState(""),
    [prompt, setPrompt] = useState(""),[files,setFiles]=useState<File[]>([]);
  const uploads=useRef(new Map<File,{key:string;id?:string}>());
  const skills = useQuery({ ...skillsQuery(), enabled: open });
  const retry = useRef({ body: "", key: "" }),
    navigate = useNavigate();
  const launch = useMutation({
    mutationFn: async () => {
      if(files.length>16)throw new Error("Select at most 16 images.");
      if(files.reduce((sum,file)=>sum+file.size,0)>16*1024*1024)throw new Error("Launch images must total at most 16 MiB.");
      const attachments:{artifactId:string}[]=[];
      for(const file of files){
        let upload=uploads.current.get(file);if(!upload){upload={key:crypto.randomUUID()};uploads.current.set(file,upload);}
        if(!upload.id){
          const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
          const sha256=Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
          const receipt=await api.POST("/api/v1/media/uploads",{body:{mediaType:file.type,byteSize:file.size,sha256,idempotencyKey:upload.key}});
          if(!receipt.data || receipt.error)throw new Error(messageOf(receipt.error));
          const stored=await api.PUT("/api/v1/media/{artifactId}",{params:{path:{artifactId:receipt.data.artifactId}},body:file as unknown as string,bodySerializer:()=>file,headers:{"Content-Type":file.type}});
          if(stored.error)throw new Error(messageOf(stored.error));upload.id=receipt.data.artifactId;
        }
        attachments.push({artifactId:upload.id});
      }
      const body = { prompt:prompt.trim() ? prompt : undefined, skill: skill || undefined,attachments:attachments.length?attachments:undefined };
      const encoded = JSON.stringify(body);
      if (retry.current.body !== encoded) retry.current = { body: encoded, key: crypto.randomUUID() };
      const { data, error } = await api.POST("/api/v1/runs", {
        body: { ...body, idempotencyKey: retry.current.key },
      });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
    onSuccess: async (receipt) => {
      await navigate({ to: "/runs/$runId", params: { runId: receipt.runId }, search: { after: 0 } });
    },
  });
  if (!open) return <Button onClick={() => setOpen(true)}>Start run</Button>;
  return (
    <Card>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          launch.mutate();
        }}
      >
        <Label>
          Skill
          <Select value={skill} onChange={(event) => setSkill(event.target.value)}>
            <option value="">No skill</option>
            {skills.data?.items?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.key}
              </option>
            ))}
          </Select>
        </Label>
        <Label>
          Prompt
          <Textarea
            required={!skill && !files.length}
            maxLength={50000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </Label>
        <Label>Images<input type="file" accept="image/*" multiple disabled={launch.isPending} onChange={event=>setFiles(Array.from(event.target.files??[]))} /></Label>
        <p className="text-sm">Original images pass directly to Pi. Up to 16 images totaling 16 MiB.</p>
        {launch.error && <p role="alert">{launch.error.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={launch.isPending}>
            Start run
          </Button>
          <Button type="button" disabled={launch.isPending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
