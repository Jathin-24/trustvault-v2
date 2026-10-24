import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
      <p className="text-sm font-semibold tracking-wide text-gray-500">404</p>
      <h1 className="mt-2 text-2xl font-bold">Page not found</h1>
      <p className="mt-3 text-gray-600">
        The page you are looking for doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700"
      >
        Go home
      </Link>
    </div>
  )
}
