'use client'

import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Button } from './button'
import { cn } from '@/lib/utils'
import {
  dialogBackdropClassName,
  dialogPopupClassName,
  dialogTitleClassName,
  dialogDescriptionClassName,
} from './dialog-styles'

type AlertDialogRootProps = React.ComponentProps<typeof AlertDialog.Root>

function AlertDialogRoot({ children, ...props }: AlertDialogRootProps) {
  return <AlertDialog.Root {...props}>{children}</AlertDialog.Root>
}

type AlertDialogTriggerProps = React.ComponentProps<typeof AlertDialog.Trigger>

function AlertDialogTrigger({ className, ...props }: AlertDialogTriggerProps) {
  return <AlertDialog.Trigger className={cn(className)} {...props} />
}

type AlertDialogContentProps = {
  className?: string
  children: React.ReactNode
}

function AlertDialogContent({ className, children }: AlertDialogContentProps) {
  return (
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className={dialogBackdropClassName} />
      <AlertDialog.Popup className={cn(dialogPopupClassName, className)}>
        {children}
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  )
}

type AlertDialogTitleProps = React.ComponentProps<typeof AlertDialog.Title>

function AlertDialogTitle({ className, ...props }: AlertDialogTitleProps) {
  return (
    <AlertDialog.Title
      className={cn(dialogTitleClassName, className)}
      {...props}
    />
  )
}

type AlertDialogDescriptionProps = React.ComponentProps<
  typeof AlertDialog.Description
>

function AlertDialogDescription({
  className,
  ...props
}: AlertDialogDescriptionProps) {
  return (
    <AlertDialog.Description
      className={cn(dialogDescriptionClassName, className)}
      {...props}
    />
  )
}

type AlertDialogCancelProps = React.ComponentProps<typeof AlertDialog.Close>

function AlertDialogCancel({ className, ...props }: AlertDialogCancelProps) {
  return (
    <AlertDialog.Close
      render={<Button variant="ghost" size="sm" className={cn(className)} />}
      {...props}
    />
  )
}

type AlertDialogActionProps = React.ComponentProps<typeof AlertDialog.Close>

function AlertDialogAction({ className, ...props }: AlertDialogActionProps) {
  return (
    <AlertDialog.Close
      render={
        <Button variant="destructive" size="sm" className={cn(className)} />
      }
      {...props}
    />
  )
}

export {
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
}
