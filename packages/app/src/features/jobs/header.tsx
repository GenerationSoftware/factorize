import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { ActionBar, Button, ResourceHeader } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { InvokeTrigger } from "./invoke";
import { TriggerTabs } from "./tabs";
import type { Trigger } from "./editor-state";

type TriggerHeaderProps = {
  trigger: Pick<Trigger, "id" | "name" | "enabled">;
};

export function TriggerActions({ trigger }: TriggerHeaderProps) {
  const cache = useQueryClient();
  const enabled = useMutation({
    retry: false,
    mutationFn: async (value: boolean) => {
      const { error } = value
        ? await api.POST("/api/v1/triggers/{triggerId}/enable", { params: { path: { triggerId: trigger.id } } })
        : await api.POST("/api/v1/triggers/{triggerId}/disable", { params: { path: { triggerId: trigger.id } } });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["triggers"] });
      await cache.invalidateQueries({ queryKey: ["triggers", "detail", trigger.id] });
    },
  });

  return <ActionBar><div role="group" aria-label="Trigger actions" className="flex max-w-full shrink-0 flex-wrap items-center gap-2"><InvokeTrigger triggerId={trigger.id} enabled={trigger.enabled} />
    <Button disabled={enabled.isPending} onClick={() => enabled.mutate(!trigger.enabled)}>{trigger.enabled ? "Disable trigger" : "Enable trigger"}</Button>
  </div>{enabled.error && <p role="alert" className="basis-full">{enabled.error.message}</p>}</ActionBar>;
}

export function TriggerHeader({ trigger }: TriggerHeaderProps) {
  return <><ResourceHeader type="Trigger" title={trigger.name}><TriggerActions trigger={trigger} /></ResourceHeader><TriggerTabs triggerId={trigger.id} /></>;
}
