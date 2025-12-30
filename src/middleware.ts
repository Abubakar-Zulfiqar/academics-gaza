import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret')

const publicPaths = ['/', '/login', '/register', '/register/volunteer', '/register/student']
const authPaths = ['/login', '/register', '/register/volunteer', '/register/student']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const accessToken = request.cookies.get('accessToken')?.value

  // Check if user is authenticated
  let isAuthenticated = false
  let userRole: string | null = null

  if (accessToken) {
    try {
      const { payload } = await jwtVerify(accessToken, JWT_SECRET)
      isAuthenticated = true
      userRole = payload.role as string
    } catch {
      // Token is invalid or expired
      isAuthenticated = false
    }
  }

  // Redirect authenticated users away from auth pages
  if (isAuthenticated && authPaths.some((path: any) => pathname === path)) {
    if (userRole === 'admin') {
      return NextResponse.redirect(new URL('/admin', request.url))
    } else if (userRole === 'volunteer') {
      return NextResponse.redirect(new URL('/volunteer', request.url))
    } else if (userRole === 'student') {
      return NextResponse.redirect(new URL('/student', request.url))
    }
  }

  // Protect dashboard routes
  if (pathname.startsWith('/admin') || pathname.startsWith('/volunteer') || pathname.startsWith('/student')) {
    if (!isAuthenticated) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Role-based access control
    if (pathname.startsWith('/admin') && userRole !== 'admin') {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (pathname.startsWith('/volunteer') && userRole !== 'volunteer') {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (pathname.startsWith('/student') && userRole !== 'student') {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
