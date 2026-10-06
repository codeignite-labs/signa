"use client";

import { useState, type FormEvent } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CertificateUploadDialog({
  kind = "signing",
  onUpload,
}: {
  kind?: "signing" | "trust";
  onUpload: (file: File, name: string, password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const signing = kind === "signing";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return;
    setPending(true);
    setError("");
    try {
      await onUpload(
        file,
        String(form.get("name")).trim(),
        String(form.get("password") ?? ""),
      );
      setOpen(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Certificate could not be uploaded",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <PlusIcon data-icon="inline-start" />
          {signing ? "Upload signing identity" : "Upload trusted CA"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {signing
              ? "Add a signing identity"
              : "Add a trusted certificate authority"}
          </DialogTitle>
          <DialogDescription>
            {signing
              ? "Upload a P12/PFX containing the document-signing certificate, its private key, and the complete certificate chain. Activate it after upload to use it for new documents."
              : "Upload a public CA certificate to trust signatures issued by that authority in this workspace. This does not change the active signing identity."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-6"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${kind}-certificate-name`}>Name</FieldLabel>
              <Input
                id={`${kind}-certificate-name`}
                name="name"
                placeholder={
                  signing
                    ? "Organization signing — 2026"
                    : "Organization root CA"
                }
                maxLength={200}
                required
                disabled={pending}
              />
              <FieldDescription>
                Use a unique, recognizable name for certificate rotation.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${kind}-certificate-file`}>
                Certificate file
              </FieldLabel>
              <Input
                id={`${kind}-certificate-file`}
                name="file"
                type="file"
                accept={signing ? ".p12,.pfx" : ".pem,.crt,.cer,.der"}
                required
                disabled={pending}
              />
            </Field>
            {signing ? (
              <Field>
                <FieldLabel htmlFor="signing-certificate-password">
                  P12/PFX password
                </FieldLabel>
                <Input
                  id="signing-certificate-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  disabled={pending}
                />
                <FieldDescription>
                  Leave blank only if the file has no password.
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Validating…" : "Upload certificate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
