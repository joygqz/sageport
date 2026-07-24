type Unlisten = () => void;

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
