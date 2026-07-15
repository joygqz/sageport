type Unlisten = () => void;

/** Installs an async Tauri event listener without leaking it after unmount. */
export function installWindowListener(
  register: () => Promise<Unlisten>,
  onError: (error: unknown) => void,
): Unlisten {
  let disposed = false;
  let unlisten: Unlisten | undefined;

  try {
    void register().then(
      (cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      },
      (error) => {
        if (!disposed) onError(error);
      },
    );
  } catch (error) {
    onError(error);
  }

  return () => {
    disposed = true;
    unlisten?.();
  };
}
