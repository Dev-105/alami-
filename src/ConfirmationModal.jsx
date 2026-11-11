import React from "react";

export default function ConfirmationModal({
  icon = "question-lg",
  title,
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  danger = false,
  children,
  onConfirm,
  onCancel,
}) {
  return <div className="confirmation-backdrop" onClick={onCancel}>
    <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" onClick={(event) => event.stopPropagation()}>
      <div className={`confirmation-icon ${danger ? "danger" : ""}`}><i className={`bi bi-${icon}`} aria-hidden="true" /></div>
      <h2 id="confirmation-title">{title}</h2>
      <p>{message}</p>
      {children}
      <div className="confirmation-actions">
        <button className={`button ${danger ? "danger-solid" : ""}`} onClick={onConfirm}>{confirmLabel}</button>
        <button className="button secondary" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </section>
  </div>;
}
