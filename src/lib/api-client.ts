export type ApiErrorOptions = {
  message: string
  status: number
}

export class ApiError extends Error {
  status: number

  constructor({ message, status }: ApiErrorOptions) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function parseJSON<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { error?: string } & T) : ({} as T)
  const errorData = data as { error?: string }
  if (!response.ok) {
    throw new ApiError({
      message:
        typeof errorData.error === 'string' && errorData.error.trim().length > 0
          ? errorData.error
          : 'Request failed',
      status: response.status,
    })
  }
  return data
}
