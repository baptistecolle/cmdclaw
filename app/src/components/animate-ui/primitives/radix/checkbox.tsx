"use client";

import { motion, SVGMotionProps, type HTMLMotionProps } from "motion/react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import * as React from "react";
import { useControlledState } from "@/hooks/use-controlled-state";
import { getStrictContext } from "@/lib/get-strict-context";

type CheckboxContextType = {
  isChecked: boolean | "indeterminate";
  setIsChecked: (checked: boolean | "indeterminate") => void;
};

const [CheckboxProvider, useCheckbox] = getStrictContext<CheckboxContextType>("CheckboxContext");
const CHECKBOX_WHILE_TAP = { scale: 0.95 };
const CHECKBOX_WHILE_HOVER = { scale: 1.05 };
const INDETERMINATE_INITIAL = { pathLength: 0, opacity: 0 };
const INDETERMINATE_ANIMATE = {
  pathLength: 1,
  opacity: 1,
  transition: { duration: 0.2 },
};
const CHECKBOX_PATH_VARIANTS = {
  checked: {
    pathLength: 1,
    opacity: 1,
    transition: {
      duration: 0.2,
      delay: 0.2,
    },
  },
  unchecked: {
    pathLength: 0,
    opacity: 0,
    transition: {
      duration: 0.2,
    },
  },
};

type CheckboxProps = HTMLMotionProps<"button"> &
  Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "asChild">;

function Checkbox({
  defaultChecked,
  checked,
  onCheckedChange,
  disabled,
  required,
  name,
  value,
  ...props
}: CheckboxProps) {
  const [isChecked, setIsChecked] = useControlledState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  const contextValue = React.useMemo(
    () => ({ isChecked, setIsChecked }),
    [isChecked, setIsChecked],
  );

  return (
    <CheckboxProvider value={contextValue}>
      <CheckboxPrimitive.Root
        defaultChecked={defaultChecked}
        checked={checked}
        onCheckedChange={setIsChecked}
        disabled={disabled}
        required={required}
        name={name}
        value={value}
        asChild
      >
        <motion.button
          data-slot="checkbox"
          whileTap={CHECKBOX_WHILE_TAP}
          whileHover={CHECKBOX_WHILE_HOVER}
          {...props}
        />
      </CheckboxPrimitive.Root>
    </CheckboxProvider>
  );
}

type CheckboxIndicatorProps = SVGMotionProps<SVGSVGElement>;

function CheckboxIndicator(props: CheckboxIndicatorProps) {
  const { isChecked } = useCheckbox();

  return (
    <CheckboxPrimitive.Indicator forceMount asChild>
      <motion.svg
        data-slot="checkbox-indicator"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="3.5"
        stroke="currentColor"
        initial="unchecked"
        animate={isChecked ? "checked" : "unchecked"}
        {...props}
      >
        {isChecked === "indeterminate" ? (
          <motion.line
            x1="5"
            y1="12"
            x2="19"
            y2="12"
            strokeLinecap="round"
            initial={INDETERMINATE_INITIAL}
            animate={INDETERMINATE_ANIMATE}
          />
        ) : (
          <motion.path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 12.75l6 6 9-13.5"
            variants={CHECKBOX_PATH_VARIANTS}
          />
        )}
      </motion.svg>
    </CheckboxPrimitive.Indicator>
  );
}

export {
  Checkbox,
  CheckboxIndicator,
  useCheckbox,
  type CheckboxProps,
  type CheckboxIndicatorProps,
  type CheckboxContextType,
};
