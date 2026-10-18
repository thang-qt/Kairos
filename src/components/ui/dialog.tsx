'use client'

import { Dialog } from '@base-ui/react/dialog'
import { Button } from './button'
import { cn } from '@/lib/utils'
import {
  dialogBackdropClassName,
  dialogPopupClassName,
  dialogTitleClassName,
  dialogDescriptionClassName,
} from './dialog-styles'

type DialogRootProps = React.ComponentProps<typeof Dialog.Root>

function DialogRoot({ children, ...props }: DialogRootProps) {
  return <Dialog.Root {...props}>{children}</Dialog.Root>
}

type DialogTriggerProps = React.ComponentProps<typeof Dialog.Trigger>

function DialogTrigger({ className, ...props }: DialogTriggerProps) {
  return <Dialog.Trigger className={cn(className)} {...props} />
}

type DialogContentProps = {
  className?: string
  children: React.ReactNode
}

function DialogContent({ className, children }: DialogContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className={dialogBackdropClassName} />
      <Dialog.Popup className={cn(dialogPopupClassName, className)}>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

type DialogTitleProps = React.ComponentProps<typeof Dialog.Title>

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <Dialog.Title className={cn(dialogTitleClassName, className)} {...props} />
  )
}

type DialogDescriptionProps = React.ComponentProps<typeof Dialog.Description>

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <Dialog.Description
      className={cn(dialogDescriptionClassName, className)}
      {...props}
    />
  )
}

type DialogCloseProps = React.ComponentProps<typeof Dialog.Close> & {
  render?: React.ReactElement
}

function DialogClose({ className, render, ...props }: DialogCloseProps) {
  return (
    <Dialog.Close
      render={
        render || <Button variant="ghost" size="sm" className={cn(className)} />
      }
      {...props}
    />
  )
}

export {
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
}
