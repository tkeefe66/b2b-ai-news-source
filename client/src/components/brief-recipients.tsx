import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { briefRecipientEmailSchema, type BriefRecipientResponse } from "@shared/brief-recipients";

const endpoint = "/api/brief/recipients";

export function BriefRecipients() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [validationError, setValidationError] = useState("");
  const query = useQuery<BriefRecipientResponse>({ queryKey: [endpoint], refetchOnWindowFocus: true, staleTime: 0 });
  const change = useMutation({
    onMutate: async () => { await queryClient.cancelQueries({ queryKey: [endpoint] }); },
    mutationFn: async ({ method, email }: { method: "POST" | "DELETE"; email: string }) => {
      const res = await apiRequest(method, endpoint, { email });
      return res.json() as Promise<BriefRecipientResponse>;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData([endpoint], data);
      if (variables.method === "POST") setEmail("");
      setMessage(variables.method === "POST"
        ? data.senderNeedsSetup ? "Recipient saved. Email sender setup is required before delivery to new recipients." : "Recipient added. They will receive the next scheduled brief."
        : "Recipient removed from future briefs.");
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: [endpoint] }); },
  });

  return <Card className="p-4 md:p-5 space-y-4">
    <div>
      <h2 className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4" />Email recipients</h2>
      <p className="text-sm text-muted-foreground mt-1">Everyone on this list receives the same weekday Morning Brief. Email subscription does not grant app access.</p>
    </div>
    {query.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading recipients…</p> : query.isError ?
      <div role="alert" className="text-sm text-destructive">Could not load recipients. <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button></div> : <>
        {query.data?.senderNeedsSetup && <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Email uses Resend’s testing sender. Before adding other people, ask your workspace administrator to configure a verified email sender.</p>}
        {query.data?.recipients.length ? <ul className="divide-y divide-border">
          {query.data.recipients.map(address => <li key={address} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm break-all">{address}</span>
            <ConfirmDestructive title="Remove email recipient?" description={`${address} will stop receiving future briefs. An email already being sent may still arrive.`} confirmLabel="Remove recipient" onConfirm={() => {
              setMessage(""); setValidationError(""); change.mutate({ method: "DELETE", email: address });
            }}>
              <Button type="button" variant="ghost" size="sm" disabled={change.isPending} aria-label={`Remove ${address}`}><Trash2 className="h-4 w-4" /><span className="ml-2">Remove</span></Button>
            </ConfirmDestructive>
          </li>)}
        </ul> : <p className="text-sm text-muted-foreground">No recipients. Scheduled emails are paused until someone is added.</p>}
        <form onSubmit={event => {
          event.preventDefault(); setMessage(""); change.reset();
          const parsed = briefRecipientEmailSchema.safeParse(email);
          if (!parsed.success) { setValidationError("Enter a valid email address."); return; }
          setValidationError(""); change.mutate({ method: "POST", email: parsed.data });
        }} className="space-y-2">
          <Label htmlFor="brief-recipient-email">Add someone to the brief</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input id="brief-recipient-email" type="email" autoComplete="email" placeholder="name@company.com" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={change.isPending} className="flex-1" />
            <Button type="submit" disabled={change.isPending || !email.trim()}><Plus className="h-4 w-4 mr-2" />{change.isPending ? "Saving…" : "Add recipient"}</Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground">Changes apply to future sends. “Send test brief now” emails everyone currently listed.</p>
      </>}
    {(validationError || change.error) && <p role="alert" className="text-sm text-destructive">{validationError || change.error?.message}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </Card>;
}
