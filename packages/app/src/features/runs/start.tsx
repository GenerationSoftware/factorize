import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Label, Select, Textarea } from "../../shared/ui";
import { projectsQuery } from "../projects/queries";
import { skillsQuery } from "../skills/queries";
import { messageOf } from "../auth/session";

export function StartRun({ projectId }: { projectId?: string }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [skill, setSkill] = useState(""),
    [prompt, setPrompt] = useState("");
  const projects = useQuery({ ...projectsQuery, enabled: open && !projectId }),
    skills = useQuery({ ...skillsQuery(), enabled: open });
  const retry = useRef({ body: "", key: "" }),
    navigate = useNavigate();
  const launch = useMutation({
    mutationFn: async () => {
      const body = { prompt, projectId: projectId || selected || undefined, skill: skill || undefined };
      const encoded = JSON.stringify(body);
      if (retry.current.body !== encoded) retry.current = { body: encoded, key: crypto.randomUUID() };
      const { data, error } = await api.POST("/api/v1/runs", {
        body: { ...body, idempotencyKey: retry.current.key },
      });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
    onSuccess: async (receipt) => {
      await navigate({ to: "/job-runs/$runId", params: { runId: receipt.runId }, search: { after: 0 } });
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
        {!projectId && (
          <Label>
            Project
            <Select required value={selected} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Select project</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Label>
        )}
        <Label>
          Launch skill
          <Select value={skill} onChange={(event) => setSkill(event.target.value)}>
            <option value="">No launch skill</option>
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
            required
            maxLength={50000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </Label>
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
