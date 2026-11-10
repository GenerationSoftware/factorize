import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label, Textarea } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { projectQuery, projectsQuery } from "./queries";
import { ProjectNav } from "./project-nav";
export function ProjectSettings() {
  const { projectId } = useParams({ from: "/projects/$projectId/settings" });
  const project = useQuery(projectQuery(projectId)), cache = useQueryClient();
  const [name, setName] = useState<string | null>(null), [description, setDescription] = useState<string | null>(null);
  const save = useMutation({ mutationFn: async () => { const nextName = (name ?? project.data!.name).trim(); if (!nextName) throw new Error("Project name is required."); const { data, error } = await api.PUT("/api/v1/projects/{projectId}", { params: { path: { projectId } }, body: { name: nextName, description: (description ?? project.data!.description ?? "").trim() || undefined } }); if (!data || error) throw new Error(messageOf(error)); return data; }, onSuccess: async updated => { cache.setQueryData(projectQuery(projectId).queryKey, updated); await cache.invalidateQueries({ queryKey: projectsQuery.queryKey }); setName(null); setDescription(null); } });
  return <ProjectNav tab="settings">{project.data&&<Card className="max-w-2xl"><h2 className="mb-5 text-xl font-semibold">Project settings</h2><form className="space-y-5" onSubmit={event => { event.preventDefault(); save.mutate(); }}><Label>Name<Input required maxLength={120} value={name ?? project.data.name} onChange={event => setName(event.target.value)} /></Label><Label>Description<Textarea maxLength={2000} value={description ?? project.data.description ?? ""} onChange={event => setDescription(event.target.value)} /></Label>{save.error&&<p role="alert">{save.error.message}</p>}{save.isSuccess&&<p role="status">Project settings saved.</p>}<Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button></form></Card>}</ProjectNav>;
}
