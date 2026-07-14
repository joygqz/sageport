import type * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

function RadioGroup(
  props: React.ComponentProps<typeof RadioGroupPrimitive.Root>,
) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" {...props} />;
}

function RadioGroupItem(
  props: React.ComponentProps<typeof RadioGroupPrimitive.Item>,
) {
  return <RadioGroupPrimitive.Item data-slot="radio-group-item" {...props} />;
}

export { RadioGroup, RadioGroupItem };
