// Match these IDs to the backend adapter registry. Shared preview and commit UI
// works for every registered format; format-specific parsing stays server-side.
export const conversationImportFormats: Array<{
  id: string
  label: string
  description: string
  accept: string
  fileLabel: string
  limits: string
}> = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    accept: '.zip,application/zip',
    fileLabel: 'export ZIP',
    limits:
      '2 GiB expanded ZIP, 256 MiB per JSON file, 64 MiB retained per conversation, 20 MiB per image, 20,000 entries.',
    description:
      'Import selected conversation paths, text, exported reasoning, and local images. PDFs, other attachments, alternate branches, and account instructions are skipped.',
  },
]
