import AuthForm from '../../../components/saas/AuthForm.js';

export const metadata = {
  title: 'Create account | NexoClip',
  description: 'Create your NexoClip workspace.',
};

export default function RegisterPage() {
  return <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4 py-12"><AuthForm mode="register" /></main>;
}
