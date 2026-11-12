"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Modal, Select } from "@/shared/components";
import { COMBO_COMPRESSION_ENGINES, normalizeComboCompression } from "@/shared/constants/comboCompression.js";

const OPTIONS = [
  { value: "inherit", label: "Use global setting" },
  { value: "on", label: "Enabled" },
  { value: "off", label: "Disabled" },
];

export default function ComboCompressionModal({ name, compression, onSave, onClose }) {
  const [draft, setDraft] = useState(() => normalizeComboCompression(compression));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const close = () => { if (!saving) onClose(); };

  const save = async () => {
    setSaving(true);
    setError("");
    const value = normalizeComboCompression(draft);
    if (!value.semanticCacheModel) delete value.semanticCacheModel;
    try {
      if (!await onSave({ compression: Object.keys(value).length ? value : null })) {
        throw new Error("Could not save token settings.");
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <Modal
      isOpen
      onClose={close}
      title={`Token settings · ${name}`}
      size="lg"
      footer={<>
        <Button variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.entries(COMBO_COMPRESSION_ENGINES).map(([key, label]) => (
          <Select
            key={key}
            label={label}
            aria-label={label}
            value={draft[key] === true ? "on" : draft[key] === false ? "off" : "inherit"}
            options={OPTIONS}
            onChange={(event) => update(key, event.target.value === "inherit" ? undefined : event.target.value === "on")}
          />
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <Input
          label="Semantic cache embedding model"
          aria-label="Semantic cache embedding model"
          placeholder="provider/embedding-model"
          value={draft.semanticCacheModel || ""}
          onChange={(event) => update("semanticCacheModel", event.target.value)}
          maxLength={200}
          hint="Leave blank to disable. Eligible text prompts are sent to this embedding model using the caller’s key. Cached responses expire after five minutes."
        />
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
    </Modal>,
    document.body
  );
}
