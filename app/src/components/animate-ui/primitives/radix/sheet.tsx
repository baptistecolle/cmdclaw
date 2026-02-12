"use client";

import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";
import { useControlledState } from "@/hooks/use-controlled-state";
import { getStrictContext } from "@/lib/get-strict-context";

type SheetContextType = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
};

type Side = "top" | "bottom" | "left" | "right";

const [SheetProvider, useSheet] = getStrictContext<SheetContextType>("SheetContext");
const SHEET_OVERLAY_DEFAULT_TRANSITION = { duration: 0.2, ease: "easeInOut" };
const SHEET_CONTENT_DEFAULT_TRANSITION = { type: "spring", stiffness: 150, damping: 22 };
const SHEET_OVERLAY_INITIAL = { opacity: 0, filter: "blur(4px)" };
const SHEET_OVERLAY_ANIMATE = { opacity: 1, filter: "blur(0px)" };
const SHEET_OVERLAY_EXIT = { opacity: 0, filter: "blur(4px)" };
const SHEET_OFFSCREEN: Record<Side, { x?: string; y?: string; opacity: number }> = {
  right: { x: "100%", opacity: 0 },
  left: { x: "-100%", opacity: 0 },
  top: { y: "-100%", opacity: 0 },
  bottom: { y: "100%", opacity: 0 },
};
const SHEET_POSITION_STYLE: Record<Side, React.CSSProperties> = {
  right: { insetBlock: 0, right: 0 },
  left: { insetBlock: 0, left: 0 },
  top: { insetInline: 0, top: 0 },
  bottom: { insetInline: 0, bottom: 0 },
};

type SheetProps = React.ComponentProps<typeof SheetPrimitive.Root>;

function Sheet(props: SheetProps) {
  const [isOpen, setIsOpen] = useControlledState({
    value: props.open,
    defaultValue: props.defaultOpen,
    onChange: props.onOpenChange,
  });

  const contextValue = React.useMemo(() => ({ isOpen, setIsOpen }), [isOpen, setIsOpen]);

  return (
    <SheetProvider value={contextValue}>
      <SheetPrimitive.Root data-slot="sheet" {...props} onOpenChange={setIsOpen} />
    </SheetProvider>
  );
}

type SheetTriggerProps = React.ComponentProps<typeof SheetPrimitive.Trigger>;

function SheetTrigger(props: SheetTriggerProps) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

type SheetCloseProps = React.ComponentProps<typeof SheetPrimitive.Close>;

function SheetClose(props: SheetCloseProps) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

type SheetPortalProps = React.ComponentProps<typeof SheetPrimitive.Portal>;

function SheetPortal(props: SheetPortalProps) {
  const { isOpen } = useSheet();

  return (
    <AnimatePresence>
      {isOpen && <SheetPrimitive.Portal forceMount data-slot="sheet-portal" {...props} />}
    </AnimatePresence>
  );
}

type SheetOverlayProps = Omit<
  React.ComponentProps<typeof SheetPrimitive.Overlay>,
  "asChild" | "forceMount"
> &
  HTMLMotionProps<"div">;

function SheetOverlay({
  transition = SHEET_OVERLAY_DEFAULT_TRANSITION,
  ...props
}: SheetOverlayProps) {
  return (
    <SheetPrimitive.Overlay asChild forceMount>
      <motion.div
        key="sheet-overlay"
        data-slot="sheet-overlay"
        initial={SHEET_OVERLAY_INITIAL}
        animate={SHEET_OVERLAY_ANIMATE}
        exit={SHEET_OVERLAY_EXIT}
        transition={transition}
        {...props}
      />
    </SheetPrimitive.Overlay>
  );
}

type SheetContentProps = React.ComponentProps<typeof SheetPrimitive.Content> &
  HTMLMotionProps<"div"> & {
    side?: Side;
  };

function SheetContent({
  side = "right",
  transition = SHEET_CONTENT_DEFAULT_TRANSITION,
  style,
  children,
  ...props
}: SheetContentProps) {
  const axis = side === "left" || side === "right" ? "x" : "y";
  const animate = React.useMemo(() => ({ [axis]: 0, opacity: 1 }), [axis]);
  const resolvedStyle = React.useMemo(
    () => ({
      position: "fixed",
      ...SHEET_POSITION_STYLE[side],
      ...style,
    }),
    [side, style],
  );

  return (
    <SheetPrimitive.Content asChild forceMount {...props}>
      <motion.div
        key="sheet-content"
        data-slot="sheet-content"
        data-side={side}
        initial={SHEET_OFFSCREEN[side]}
        animate={animate}
        exit={SHEET_OFFSCREEN[side]}
        style={resolvedStyle}
        transition={transition}
      >
        {children}
      </motion.div>
    </SheetPrimitive.Content>
  );
}

type SheetHeaderProps = React.ComponentProps<"div">;

function SheetHeader(props: SheetHeaderProps) {
  return <div data-slot="sheet-header" {...props} />;
}

type SheetFooterProps = React.ComponentProps<"div">;

function SheetFooter(props: SheetFooterProps) {
  return <div data-slot="sheet-footer" {...props} />;
}

type SheetTitleProps = React.ComponentProps<typeof SheetPrimitive.Title>;

function SheetTitle(props: SheetTitleProps) {
  return <SheetPrimitive.Title data-slot="sheet-title" {...props} />;
}

type SheetDescriptionProps = React.ComponentProps<typeof SheetPrimitive.Description>;

function SheetDescription(props: SheetDescriptionProps) {
  return <SheetPrimitive.Description data-slot="sheet-description" {...props} />;
}

export {
  useSheet,
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetProps,
  type SheetPortalProps,
  type SheetOverlayProps,
  type SheetTriggerProps,
  type SheetCloseProps,
  type SheetContentProps,
  type SheetHeaderProps,
  type SheetFooterProps,
  type SheetTitleProps,
  type SheetDescriptionProps,
};
