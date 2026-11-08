import { Link } from 'react-router';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-6xl font-extrabold text-brand-600">404</p>
        <p className="mt-2 text-muted">This page does not exist.</p>
        <Link to="/login" className="mt-4 inline-block font-semibold text-brand-600 hover:underline">
          Go home
        </Link>
      </div>
    </div>
  );
}
