"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  type HTMLMotionProps,
  type MotionValue,
  type SpringOptions,
  type Transition,
} from "motion/react";
import * as React from "react";
import { useControlledState } from "@/hooks/use-controlled-state";
import { getStrictContext } from "@/lib/get-strict-context";

type TooltipContextType = {
  isOpen: boolean;
  setIsOpen: TooltipProps["onOpenChange"];
  x: MotionValue<number>;
  y: MotionValue<number>;
  followCursor?: boolean | "x" | "y";
  followCursorSpringOptions?: SpringOptions;
};

const [LocalTooltipProvider, useTooltip] = getStrictContext<TooltipContextType>("TooltipContext");
const TOOLTIP_DEFAULT_SPRING_OPTIONS = { stiffness: 200, damping: 17 };
const TOOLTIP_POPUP_DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 25,
};
const TOOLTIP_POPUP_INITIAL = { opacity: 0, scale: 0.5 };
const TOOLTIP_POPUP_ANIMATE = { opacity: 1, scale: 1 };
const TOOLTIP_POPUP_EXIT = { opacity: 0, scale: 0.5 };

type TooltipProviderProps = React.ComponentProps<typeof TooltipPrimitive.Provider>;

function TooltipProvider(props: TooltipProviderProps) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />;
}

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root> & {
  followCursor?: boolean | "x" | "y";
  followCursorSpringOptions?: SpringOptions;
};

function Tooltip({
  followCursor = false,
  followCursorSpringOptions = TOOLTIP_DEFAULT_SPRING_OPTIONS,
  ...props
}: TooltipProps) {
  const [isOpen, setIsOpen] = useControlledState({
    value: props?.open,
    defaultValue: props?.defaultOpen,
    onChange: props?.onOpenChange,
  });
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const contextValue = React.useMemo(
    () => ({
      isOpen,
      setIsOpen,
      x,
      y,
      followCursor,
      followCursorSpringOptions,
    }),
    [followCursor, followCursorSpringOptions, isOpen, setIsOpen, x, y],
  );

  return (
    <LocalTooltipProvider value={contextValue}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} onOpenChange={setIsOpen} />
    </LocalTooltipProvider>
  );
}

type TooltipTriggerProps = React.ComponentProps<typeof TooltipPrimitive.Trigger>;

function TooltipTrigger({ onMouseMove, ...props }: TooltipTriggerProps) {
  const { x, y, followCursor } = useTooltip();

  const handleMouseMove = React.useCallback(
    (event: Parameters<NonNullable<TooltipTriggerProps["onMouseMove"]>>[0]) => {
      onMouseMove?.(event);

      const target = event.currentTarget.getBoundingClientRect();

      if (followCursor === "x" || followCursor === true) {
        const eventOffsetX = event.clientX - target.left;
        const offsetXFromCenter = (eventOffsetX - target.width / 2) / 2;
        x.set(offsetXFromCenter);
      }

      if (followCursor === "y" || followCursor === true) {
        const eventOffsetY = event.clientY - target.top;
        const offsetYFromCenter = (eventOffsetY - target.height / 2) / 2;
        y.set(offsetYFromCenter);
      }
    },
    [followCursor, onMouseMove, x, y],
  );

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onMouseMove={handleMouseMove}
      {...props}
    />
  );
}

type TooltipPortalProps = Omit<React.ComponentProps<typeof TooltipPrimitive.Portal>, "keepMounted">;

function TooltipPortal(props: TooltipPortalProps) {
  const { isOpen } = useTooltip();

  return (
    <AnimatePresence>
      {isOpen && <TooltipPrimitive.Portal keepMounted data-slot="tooltip-portal" {...props} />}
    </AnimatePresence>
  );
}

type TooltipPositionerProps = React.ComponentProps<typeof TooltipPrimitive.Positioner>;

function TooltipPositioner(props: TooltipPositionerProps) {
  return <TooltipPrimitive.Positioner data-slot="tooltip-positioner" {...props} />;
}

type TooltipPopupProps = Omit<React.ComponentProps<typeof TooltipPrimitive.Popup>, "render"> &
  HTMLMotionProps<"div">;

function TooltipPopup({
  transition = TOOLTIP_POPUP_DEFAULT_TRANSITION,
  style,
  ...props
}: TooltipPopupProps) {
  const { x, y, followCursor, followCursorSpringOptions } = useTooltip();
  const translateX = useSpring(x, followCursorSpringOptions);
  const translateY = useSpring(y, followCursorSpringOptions);
  const popupStyle = React.useMemo(
    () => ({
      x: followCursor === "x" || followCursor === true ? translateX : undefined,
      y: followCursor === "y" || followCursor === true ? translateY : undefined,
      ...style,
    }),
    [followCursor, style, translateX, translateY],
  );
  const popupRender = React.useMemo(
    () => (
      <motion.div
        key="tooltip-popup"
        data-slot="tooltip-popup"
        initial={TOOLTIP_POPUP_INITIAL}
        animate={TOOLTIP_POPUP_ANIMATE}
        exit={TOOLTIP_POPUP_EXIT}
        transition={transition}
        style={popupStyle}
        {...props}
      />
    ),
    [popupStyle, props, transition],
  );

  return <TooltipPrimitive.Popup render={popupRender} />;
}

type TooltipArrowProps = React.ComponentProps<typeof TooltipPrimitive.Arrow>;

function TooltipArrow(props: TooltipArrowProps) {
  return <TooltipPrimitive.Arrow data-slot="tooltip-arrow" {...props} />;
}

export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipPositioner,
  TooltipPopup,
  TooltipArrow,
  useTooltip,
  type TooltipProviderProps,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipPortalProps,
  type TooltipPositionerProps,
  type TooltipPopupProps,
  type TooltipArrowProps,
  type TooltipContextType,
};
