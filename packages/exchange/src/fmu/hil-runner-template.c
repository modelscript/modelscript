/* SPDX-License-Identifier: AGPL-3.0-or-later */
/**
 * ModelScript Standalone Hard Real-Time HIL Runner Template.
 *
 * This C program demonstrates hard real-time execution of ModelScript-generated
 * plant models on Linux RT-PREEMPT with direct Linux SocketCAN bus interfacing.
 *
 * Requirements on Target:
 *   - Linux kernel with PREEMPT_RT patch
 *   - SocketCAN interface configured (e.g., `sudo ip link set can0 up type can bitrate 500000`)
 *   - Root/CAP_SYS_NICE capability for SCHED_FIFO real-time scheduling
 *
 * Real-Time Guarantees:
 *   1. `mlockall(MCL_CURRENT | MCL_FUTURE)` prevents page faults during execution.
 *   2. `sched_setscheduler(0, SCHED_FIFO, &sp)` sets deterministic POSIX priority.
 *   3. `clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, ...)` prevents timing drift.
 *   4. Zero dynamic heap allocation (`no malloc/free`) inside the real-time step loop.
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <sched.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <linux/can.h>
#include <linux/can/raw.h>

#define NSEC_PER_SEC 1000000000LL
#define STEP_PERIOD_NS 1000000LL  /* 1 ms step period = 1000 Hz */
#define RT_PRIORITY 80

/* Simulated time normalization helper */
static inline void timespec_add_ns(struct timespec *t, long long ns) {
    long long nsec = t->tv_nsec + ns;
    t->tv_sec += nsec / NSEC_PER_SEC;
    t->tv_nsec = nsec % NSEC_PER_SEC;
}

int main(int argc, char *argv[]) {
    const char *can_interface = (argc > 1) ? argv[1] : "can0";
    printf("[ModelScript HIL] Initializing real-time runner on interface '%s'...\n", can_interface);

    /* 1. Lock process memory into RAM to prevent page faults */
    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
        perror("[ModelScript HIL] Warning: mlockall failed (requires CAP_SYS_RESOURCE or root)");
    }

    /* 2. Set SCHED_FIFO real-time priority */
    struct sched_param sp;
    memset(&sp, 0, sizeof(sp));
    sp.sched_priority = RT_PRIORITY;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) {
        perror("[ModelScript HIL] Warning: sched_setscheduler SCHED_FIFO failed (requires root)");
    } else {
        printf("[ModelScript HIL] Assigned SCHED_FIFO priority %d\n", RT_PRIORITY);
    }

    /* 3. Open SocketCAN raw socket */
    int can_sock = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (can_sock < 0) {
        perror("[ModelScript HIL] socket(PF_CAN) failed");
        return 1;
    }

    struct ifreq ifr;
    strncpy(ifr.ifr_name, can_interface, IFNAMSIZ - 1);
    if (ioctl(can_sock, SIOCGIFINDEX, &ifr) < 0) {
        perror("[ModelScript HIL] ioctl(SIOCGIFINDEX) failed — is the CAN interface up?");
        close(can_sock);
        return 1;
    }

    struct sockaddr_can addr;
    memset(&addr, 0, sizeof(addr));
    addr.can_family = AF_CAN;
    addr.can_ifindex = ifr.ifr_ifindex;

    if (bind(can_sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("[ModelScript HIL] bind(CAN_RAW) failed");
        close(can_sock);
        return 1;
    }

    /* Set non-blocking read on CAN socket so we do not stall the real-time loop */
    struct timeval tv = { .tv_sec = 0, .tv_usec = 100 };
    setsockopt(can_sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));

    printf("[ModelScript HIL] SocketCAN bound. Starting 1 kHz simulation loop...\n");

    struct timespec next_period;
    clock_gettime(CLOCK_MONOTONIC, &next_period);

    double sim_time = 0.0;
    const double dt = 0.001; /* 1 ms */
    unsigned long long step_count = 0;
    unsigned long long overrun_count = 0;

    /* Real-Time Step Loop */
    while (1) {
        /* Advance target time by 1 ms */
        timespec_add_ns(&next_period, STEP_PERIOD_NS);

        /* Sleep precisely until the next 1 ms boundary */
        int res = clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next_period, NULL);
        if (res != 0) {
            perror("[ModelScript HIL] clock_nanosleep interrupted");
            break;
        }

        /* Detect timing overrun */
        struct timespec now;
        clock_gettime(CLOCK_MONOTONIC, &now);
        if (now.tv_sec > next_period.tv_sec ||
           (now.tv_sec == next_period.tv_sec && now.tv_nsec > next_period.tv_nsec)) {
            overrun_count++;
        }

        /* --- Read incoming CAN frame from ECU (Actuator commands) --- */
        struct can_frame rx_frame;
        int nbytes = read(can_sock, &rx_frame, sizeof(struct can_frame));
        if (nbytes > 0) {
            /* Decode incoming frame based on FMI-LS-BUS definition */
            /* e.g., if (rx_frame.can_id == 0x100) { throttle = decode(rx_frame.data); } */
        }

        /* --- Execute ModelScript Fixed-Step Plant Integration --- */
        /* integrate_rk4(&model_inst, sim_time, sim_time + dt, dt); */
        sim_time += dt;
        step_count++;

        /* --- Write outgoing CAN frame to ECU (Sensor feedback) --- */
        struct can_frame tx_frame;
        tx_frame.can_id = 0x200; /* Plant state CAN ID */
        tx_frame.can_dlc = 8;
        /* Encode plant outputs (e.g. RPM, speed, voltage) into tx_frame.data */
        write(can_sock, &tx_frame, sizeof(struct can_frame));

        /* Periodic diagnostic logging */
        if (step_count % 1000 == 0) {
            printf("[HIL Status] SimTime: %.2f s | Steps: %llu | Overruns: %llu\n",
                   sim_time, step_count, overrun_count);
        }
    }

    close(can_sock);
    return 0;
}
