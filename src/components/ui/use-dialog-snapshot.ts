import { useState } from "react";

export function useDialogSnapshot<T>(open: boolean, value: T): T {
  const [lastOpen, setLastOpen] = useState(value);
  if (open && !Object.is(lastOpen, value)) setLastOpen(value);
  return open ? value : lastOpen;
}
