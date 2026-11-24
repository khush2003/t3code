/**
 * Starts every message a person sends from the screen that shows their bots. A bot answers
 * such a message for the ear, and only then is there a screen for it to show things on.
 */
export const BOT_SPOKEN_PREFIX = "(voice) ";

const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The handed-over file a bot means when it names one: by its id, else by its title or file name,
 * else by words those contain. The newest wins when several fit. The server uses it to refuse a
 * file that is not there, and the screen uses it to open the same one.
 */
export function findBotFile<
  File extends {
    readonly id: string;
    readonly title: string;
    readonly name: string | null;
    readonly createdAt: string;
  },
>(files: ReadonlyArray<File>, wanted: string): File | null {
  const want = plain(wanted);
  if (want === "") return null;
  const newest = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const names = (file: File) => [
    plain(file.title),
    ...(file.name === null ? [] : [plain(file.name)]),
  ];
  return (
    newest.find((file) => file.id === wanted.trim()) ??
    newest.find((file) => names(file).includes(want)) ??
    newest.find((file) => names(file).some((name) => name.includes(want))) ??
    null
  );
}
