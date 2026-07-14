import type * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

function Tabs(props: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

function TabsList(props: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" {...props} />;
}

function TabsTrigger(
  props: React.ComponentProps<typeof TabsPrimitive.Trigger>,
) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" {...props} />;
}

function TabsContent(
  props: React.ComponentProps<typeof TabsPrimitive.Content>,
) {
  return <TabsPrimitive.Content data-slot="tabs-content" {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
