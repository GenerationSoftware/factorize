import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Breadcrumb, Button, Input, Label, Page, ResourceHeader, Textarea } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { messageOf } from "../auth/session";
import { projectQuery, projectsQuery } from "./queries";
import { JobsTable } from "../jobs/list";

export function ProjectDetail() {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const project = useQuery(projectQuery(projectId));
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState("");
  const edit = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Project name is required.");
      const { data, error } = await api.PUT("/api/v1/projects/{projectId}", { params: { path: { projectId } }, body: { name: trimmedName, description: description.trim() || undefined } });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
    onSuccess: async updated => {
      cache.setQueryData(projectQuery(projectId).queryKey, updated);
      cache.setQueryData(projectsQuery.queryKey, (projects) => projects?.map(item => item.id === updated.id ? { ...item, ...updated } : item));
      setEditing(false);
      setValidationError("");
      await cache.invalidateQueries({ queryKey: projectsQuery.queryKey });
    },
    onError: error => setValidationError(error.message),
  });
  const openEditor = () => {
    if (!project.data) return;
    setName(project.data.name);
    setDescription(project.data.description ?? "");
    setValidationError("");
    setEditing(true);
  };
  return <Page className="max-w-6xl"><Breadcrumb><Link to="/projects" className="font-semibold">Projects</Link></Breadcrumb><ResourceHeader type="Project" title={project.data?.name ?? "Project"} description={project.data?.description}><div className="flex flex-wrap gap-2">{project.data && <><Button onClick={openEditor}>Edit</Button><Link to="/jobs/new" search={{ projectId }}><Button variant="primary">Create job</Button></Link></>}</div></ResourceHeader>{project.isPending && <p role="status">Loading project…</p>}{project.error && <p role="alert">{project.error.message}</p>}{project.data&&<><JobsTable projectId={projectId} />{editing&&<Dialog title="Edit project" close={() => { if (!edit.isPending) setEditing(false); }}><form className="space-y-5" onSubmit={event => { event.preventDefault(); edit.mutate(); }}><Label>Name<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Label><Label>Description<Textarea maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></Label>{validationError&&<p role="alert">{validationError}</p>}<div className="flex justify-end gap-2"><Button type="button" onClick={() => setEditing(false)} disabled={edit.isPending}>Cancel</Button><Button type="submit" variant="primary" disabled={edit.isPending}>{edit.isPending ? "Saving…" : "Save changes"}</Button></div></form></Dialog>}</>}</Page>;
}
