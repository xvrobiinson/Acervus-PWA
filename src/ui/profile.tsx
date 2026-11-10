// The person's profile (roadmap 41, 2026-11-10): their name, shown in the
// account panel and the greeting, and a photo they can add, change or
// remove (initials without one). Kept with the account (convex/account.ts),
// so every phone and PC shows the same.

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { describeError } from "../lib/errors";
import { useT } from "../lib/i18n";
import { useApp } from "../state/app";
import { Icon } from "./icons";
import { Button, Field, Sheet, useToast } from "./kit";

/** Two letters for a person without a photo: from the name, else the email. */
export const initials = (name: string, email: string) =>
  (name.trim() || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/** The photo, or the initials when there is none (or it can't load). */
export function FaceImage({ name, email, photoUrl }: { name: string; email: string; photoUrl?: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (photoUrl && broken !== photoUrl) return <img className="face-img" src={photoUrl} alt="" onError={() => setBroken(photoUrl)} />;
  return <>{initials(name, email || "?")}</>;
}

/** A square JPEG from the middle of the picture, at most 400px. */
async function square(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(400, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image"))), "image/jpeg", 0.88));
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const app = useApp();
  const toast = useToast();
  const user = app.user;
  const online = app.mode === "online";
  const setName = useMutation(api.account.setName);
  const uploadUrl = useMutation(api.account.photoUploadUrl);
  const setPhoto = useMutation(api.account.setPhoto);
  const removePhoto = useMutation(api.account.removePhoto);
  const [name, setNameText] = useState(user?.name ?? "");
  const [busy, setBusy] = useState<"name" | "photo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const saveName = async () => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) {
      setError(t("Write your name", "Escribe tu nombre"));
      return;
    }
    setBusy("name");
    setError(null);
    try {
      await setName({ name: clean });
      toast(t("Name saved.", "Nombre guardado."));
      onClose();
    } catch (e) {
      setError(describeError(t, app.fmt, e));
    } finally {
      setBusy(null);
    }
  };
  const upload = async (file: File) => {
    setBusy("photo");
    try {
      const blob = await square(file);
      const post = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!post.ok) throw new Error(String(post.status));
      const { storageId } = (await post.json()) as { storageId: Id<"_storage"> };
      await setPhoto({ storageId });
      toast(t("Photo saved.", "Foto guardada."));
    } catch (e) {
      toast(describeError(t, app.fmt, e), true);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("photo");
    try {
      await removePhoto({});
      toast(t("Photo removed.", "Foto quitada."));
    } catch (e) {
      toast(describeError(t, app.fmt, e), true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      title={t("Your profile", "Tu perfil")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button variant="primary" loading={busy === "name"} disabled={!online || name.trim() === (user.name ?? "").trim()} onClick={() => void saveName()}>
            {t("Save", "Guardar")}
          </Button>
        </>
      }
    >
      <div className="profile-sheet">
        <div className="profile-photo">
          <span className="profile-face" aria-hidden="true">
            <FaceImage name={name || user.name} email={user.email} photoUrl={user.photoUrl} />
          </span>
          {online ? (
            <div className="actions">
              <label className={`btn ${busy === "photo" ? "is-busy" : ""}`}>
                <Icon name="image" />
                {user.photoUrl ? t("Change photo", "Cambiar foto") : t("Add a photo", "Agregar una foto")}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy !== null} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              </label>
              {user.photoUrl && (
                <Button variant="danger-ghost" disabled={busy !== null} onClick={() => void remove()}>
                  {t("Remove", "Quitar")}
                </Button>
              )}
            </div>
          ) : (
            <span className="small muted">{t("Needs a connection.", "Necesita conexión.")}</span>
          )}
        </div>
        <Field label={t("Your name", "Tu nombre")} hint={t("Your team sees it, and the greeting uses it.", "Tu equipo lo ve, y el saludo lo usa.")} error={error}>
          {(id) => (
            <input
              id={id}
              className="input"
              autoComplete="name"
              maxLength={100}
              value={name}
              disabled={!online}
              onChange={(e) => setNameText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveName()}
            />
          )}
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          {t(`Signed in as ${user.email}`, `Sesión iniciada como ${user.email}`)}
        </p>
      </div>
    </Sheet>
  );
}
