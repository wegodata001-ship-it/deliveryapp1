"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  customerId?: string | null;
};

type State = {
  error: Error | null;
  componentStack: string | null;
};

/** תופס קריסות render בכרטסת — מציג שגיאה מלאה ב-console (לא רק #310 / #418) */
export class CustomerLedgerErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CustomerLedger] crash", {
      customerId: this.props.customerId ?? null,
      message: error.message,
      name: error.name,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private retry = () => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="adm-error adm-error--compact adm-ledger-error-boundary" role="alert">
          <p>שגיאה בטעינת כרטסת הלקוח</p>
          <p dir="ltr" className="adm-ledger-error-boundary__msg">
            {this.state.error.message}
          </p>
          {this.state.componentStack ? (
            <pre dir="ltr" className="adm-ledger-error-boundary__stack">
              {this.state.componentStack}
            </pre>
          ) : null}
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={this.retry}>
            נסה שוב
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
