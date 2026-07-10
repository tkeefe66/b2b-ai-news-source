import { ReactNode, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Shared guard for irreversible actions. Wrap the trigger element; the action
 * only fires after explicit confirmation. Name the object being destroyed and
 * state the blast radius in `description` — never a bare "Are you sure?".
 *
 * <ConfirmDestructive
 *   title={`Delete "${session.title}"?`}
 *   description="This chat session and its messages are permanently deleted. This can't be undone."
 *   confirmLabel="Delete"
 *   onConfirm={() => deleteMutation.mutate(session.id)}
 * >
 *   <Button variant="ghost" size="icon" aria-label="Delete session"><Trash2 /></Button>
 * </ConfirmDestructive>
 */
export function ConfirmDestructive({
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-confirm-destructive"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
