import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { cn } from "@video-transcriber/ui/lib/utils";
import * as React from "react";

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root {...props} />;
}

function AlertDialogTrigger({
  className,
  ...props
}: AlertDialogPrimitive.Trigger.Props & React.RefAttributes<HTMLButtonElement>) {
  return <AlertDialogPrimitive.Trigger className={cn(className)} {...props} />;
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop
        className={cn("fixed inset-0 z-50 bg-black/50 backdrop-blur-sm", className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogPopup({
  className,
  children,
  ...props
}: AlertDialogPrimitive.Popup.Props & { children: React.ReactNode }) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-6 shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogTitle({
  className,
  ...props
}: AlertDialogPrimitive.Title.Props & React.RefAttributes<HTMLHeadingElement>) {
  return <AlertDialogPrimitive.Title className={cn("text-sm font-medium", className)} {...props} />;
}

function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props & React.RefAttributes<HTMLParagraphElement>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("mt-2 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogClose({
  className,
  ...props
}: AlertDialogPrimitive.Close.Props & React.RefAttributes<HTMLButtonElement>) {
  return <AlertDialogPrimitive.Close className={cn(className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
};
