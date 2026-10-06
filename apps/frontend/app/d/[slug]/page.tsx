import { StartFormPage } from "./start-form-page";

export default async function PublicStartFormRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <StartFormPage key={slug} slug={slug} />;
}
