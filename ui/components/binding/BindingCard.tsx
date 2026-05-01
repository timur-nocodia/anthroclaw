"use client";

import { useState } from "react";
import { Edit2, FlaskConical, MessageCircle, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  describeBinding,
  type BindingDescribeContext,
  type BindingRouteInput,
} from "@/components/binding/binding-language";

export interface BindingCardProps<R extends BindingRouteInput = BindingRouteInput> {
  route: R;
  context?: BindingDescribeContext;
  onEdit?: (route: R) => void;
  onRemove?: (route: R) => void;
  onTest?: (route: R) => void;
}

function ChannelIcon({ icon }: { icon: "telegram" | "whatsapp" | "other" }) {
  if (icon === "telegram") {
    return (
      <Send
        className="h-3.5 w-3.5"
        style={{ color: "var(--oc-accent)" }}
        aria-label="Telegram"
      />
    );
  }
  if (icon === "whatsapp") {
    return (
      <MessageCircle
        className="h-3.5 w-3.5"
        style={{ color: "var(--oc-accent)" }}
        aria-label="WhatsApp"
      />
    );
  }
  return null;
}

export function BindingCard<R extends BindingRouteInput = BindingRouteInput>({
  route,
  context,
  onEdit,
  onRemove,
  onTest,
}: BindingCardProps<R>) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const desc = describeBinding(route, context);

  return (
    <div
      className="rounded-md p-3"
      style={{
        background: "var(--oc-bg0)",
        border: "1px solid var(--oc-border)",
      }}
      data-testid="binding-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <ChannelIcon icon={desc.icon} />
            <span
              className="text-[12.5px] font-semibold"
              style={{ color: "var(--color-foreground)" }}
            >
              {desc.title}
            </span>
          </div>
          <ul
            className="flex flex-col gap-0.5"
            data-testid="binding-card-lines"
          >
            {desc.lines.map((line, i) => (
              <li
                key={i}
                className="text-[12px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(route)}
              aria-label="Edit binding"
              data-testid="binding-card-edit"
            >
              <Edit2 className="h-3 w-3" />
              Edit
            </Button>
          )}
          {onTest && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTest(route)}
              aria-label="Test binding"
              data-testid="binding-card-test"
            >
              <FlaskConical className="h-3 w-3" />
              Test
            </Button>
          )}
          {onRemove && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                aria-label="Remove binding"
                data-testid="binding-card-remove"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </Button>
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove this binding?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Stop listening in this scope? The agent will not see new
                      messages here unless re-bound.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="binding-card-remove-cancel">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="binding-card-remove-confirm"
                      onClick={() => {
                        setConfirmOpen(false);
                        onRemove(route);
                      }}
                    >
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
