import { SigningPage } from "./signing-page";

export default async function PublicSigningPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ f?: string; t?: string }>;
}) {
  const { slug } = await params;
  const { f, t } = await searchParams;

  return <SigningPage key={slug} focusFieldPrefix={f} slug={slug} trackingParam={t} />;
}
