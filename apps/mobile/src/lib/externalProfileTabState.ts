type ExternalProfileTabListener =
  () => void;

let externalProfileActive = false;

const listeners =
  new Set<ExternalProfileTabListener>();

export function getExternalProfileTabActive() {
  return externalProfileActive;
}

export function setExternalProfileTabActive(
  active: boolean
) {
  const next = Boolean(active);

  if (next === externalProfileActive) {
    return;
  }

  externalProfileActive = next;

  for (const listener of listeners) {
    listener();
  }

  console.log(
    "KRISTO_EXTERNAL_PROFILE_TAB_STATE",
    {
      active: externalProfileActive,
      label: externalProfileActive
        ? "Profile"
        : "Me",
    }
  );
}

export function subscribeExternalProfileTab(
  listener: ExternalProfileTabListener
) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
