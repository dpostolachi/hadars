import { getHadarsRepoInfo } from "./githubRepo";
import type { DataCard, DataCardKind } from "./demo-protocol";

/** Invoked only inside useServerData loaders; removed from browser bundles. */
export async function readDemoCard(
  kind: DataCardKind,
): Promise<DataCard & { source: string }> {
  const repo = await getHadarsRepoInfo();
  const cards: Record<DataCardKind, DataCard> = {
    release: {
      kind: "release",
      value: repo.latestRelease,
      detail: "Latest published release",
    },
    branch: {
      kind: "branch",
      value:
        repo.latestCommitSha || repo.latestRelease ? repo.defaultBranch : null,
      detail: "Default repository branch",
    },
    commit: {
      kind: "commit",
      value: repo.latestCommitSha,
      detail: repo.latestCommitDate,
    },
    message: {
      kind: "message",
      value: repo.latestCommitMessage,
      detail: repo.latestCommitSha,
    },
  };
  return { ...cards[kind], source: "hadars-server-data-demo-loader" };
}
