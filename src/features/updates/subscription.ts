import type { UpdateStatus } from "@/types/models";

type Unlisten = () => void;

export async function initializeUpdateStatus({
  listen,
  read,
  apply,
  active,
}: {
  listen: (handler: (status: UpdateStatus) => void) => Promise<Unlisten>;
  read: () => Promise<UpdateStatus>;
  apply: (status: UpdateStatus) => void;
  active: () => boolean;
}): Promise<Unlisten> {
  let eventRevision = 0;
  const unlisten = await listen((status) => {
    eventRevision += 1;
    if (active()) apply(status);
  });

  if (!active()) {
    unlisten();
    return () => {};
  }

  try {
    const revisionBeforeSnapshot = eventRevision;
    const snapshot = await read();
    if (active() && eventRevision === revisionBeforeSnapshot) {
      apply(snapshot);
    }
    return unlisten;
  } catch (error) {
    unlisten();
    throw error;
  }
}

export async function probeSelfUpdate(
  probe: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await probe();
  } catch {
    return false;
  }
}
