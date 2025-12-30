import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import { z } from 'zod'

const causeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  region: z.string().optional(),
  priority: z.number().optional().default(0),
  isActive: z.boolean().optional().default(true),
})

// GET - Get all causes
export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const causes = await prisma.cause.findMany({
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    })

    // Get stats for each cause
    const causesWithStats = await Promise.all(
      causes.map(async (cause: any) => {
        const [studentCount, volunteerCount] = await Promise.all([
          prisma.student.count({ where: { cause: cause.name } }),
          prisma.volunteer.count({ where: { causes: { has: cause.name } } }),
        ])
        return {
          ...cause,
          studentCount,
          volunteerCount,
        }
      })
    )

    return NextResponse.json({ causes: causesWithStats })
  } catch (error) {
    console.error('Error fetching causes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new cause
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const validation = causeSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid cause data', details: validation.error.issues },
        { status: 400 }
      )
    }

    const { name, description, region, priority, isActive } = validation.data

    // Check for duplicate name
    const existing = await prisma.cause.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'A cause with this name already exists' },
        { status: 400 }
      )
    }

    const cause = await prisma.cause.create({
      data: {
        name,
        description,
        region,
        priority,
        isActive,
        createdBy: payload.userId,
      },
    })

    return NextResponse.json({ cause }, { status: 201 })
  } catch (error) {
    console.error('Error creating cause:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
