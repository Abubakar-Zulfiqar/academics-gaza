import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'

const VALID_STATUSES = [
  'auto_suggested',
  'pending_email',
  'email_sent',
  'accepted',
  'active',
  'rejected',
  'not_compatible',
  'completed',
  'paused',
] as const

type MatchStatus = (typeof VALID_STATUSES)[number]

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params
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
    const { status, notes } = body

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be one of: ' + VALID_STATUSES.join(', ') },
        { status: 400 }
      )
    }

    // Get the current match
    const currentMatch = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        volunteer: true,
        student: true,
      },
    })

    if (!currentMatch) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    // Prepare update data
    const updateData: {
      status: MatchStatus
      adminId: string
      adminNotes?: string
      emailSentAt?: Date
      volunteerRespondedAt?: Date
      startDate?: Date
      endDate?: Date
    } = {
      status: status as MatchStatus,
      adminId: payload.userId,
    }

    // Add notes if provided
    if (notes) {
      updateData.adminNotes = notes
    }

    // Set timestamps based on status change
    if (status === 'email_sent' && currentMatch.status !== 'email_sent') {
      updateData.emailSentAt = new Date()
    }

    if (['accepted', 'active'].includes(status) && !currentMatch.volunteerRespondedAt) {
      updateData.volunteerRespondedAt = new Date()
    }

    if (status === 'active' && !currentMatch.startDate) {
      updateData.startDate = new Date()
    }

    if (['completed', 'rejected', 'not_compatible'].includes(status) && !currentMatch.endDate) {
      updateData.endDate = new Date()
    }

    // Calculate capacity change based on status transition
    const wasActive = ['accepted', 'active'].includes(currentMatch.status)
    const willBeActive = ['accepted', 'active'].includes(status)
    const willBeInactive = ['rejected', 'not_compatible', 'completed', 'paused'].includes(status)

    let capacityChange = 0
    if (!wasActive && willBeActive) {
      // Becoming active - increase capacity
      capacityChange = 1
    } else if (wasActive && willBeInactive) {
      // Becoming inactive - decrease capacity
      capacityChange = -1
    }

    // Update the match and volunteer capacity in a transaction
    const updatedMatch = await prisma.$transaction(async (tx: any) => {
      const match = await tx.match.update({
        where: { id: matchId },
        data: updateData,
        include: {
          volunteer: {
            select: {
              id: true,
              fullName: true,
            },
          },
          student: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      })

      // Update volunteer capacity if needed
      if (capacityChange !== 0) {
        await tx.volunteer.update({
          where: { id: currentMatch.volunteerId },
          data: {
            currentCapacity: {
              increment: capacityChange,
            },
          },
        })
      }

      return match
    })

    return NextResponse.json({
      success: true,
      match: updatedMatch,
    })
  } catch (error) {
    console.error('Error updating match status:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
