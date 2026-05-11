"use client";

type Props = {
  active: boolean;
};

export function TopLoadingBar({ active }: Props) {
  return (
    <div className="ui-top-loading-bar" data-active={active ? "true" : "false"} aria-hidden>
      <div className="ui-top-loading-bar__track" />
    </div>
  );
}
