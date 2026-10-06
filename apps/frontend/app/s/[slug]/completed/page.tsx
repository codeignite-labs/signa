import { CompletedSigningPage } from "../completed-signing-page";

export default async function PublicSigningCompletedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <CompletedSigningPage key={slug} slug={slug} />;
}
