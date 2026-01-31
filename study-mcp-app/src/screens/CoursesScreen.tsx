import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AntDesign } from '@expo/vector-icons';
import { d2lService } from '../services/d2l';

interface Course {
    id: string;
    name: string;
    code: string;
    orgUnitId?: number;
}

export default function CoursesScreen() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigation = useNavigation();

    const loadCourses = async () => {
        try {
            setError(null);
            const data = await d2lService.getCourses();
            setCourses(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load courses');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadCourses();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        loadCourses();
    };

    const renderCourseCard = ({ item }: { item: Course }) => (
        <TouchableOpacity
            style={styles.courseCard}
            onPress={() => (navigation.navigate as any)('CourseDetail', { course: item })}
        >
            <View style={styles.courseIcon}>
                <AntDesign name="book" size={24} color="#6366f1" />
            </View>
            <View style={styles.courseInfo}>
                <Text style={styles.courseName}>{item.name}</Text>
                <Text style={styles.courseCode}>{item.code}</Text>
            </View>
            <AntDesign name="right" size={20} color="#94a3b8" />
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={styles.loadingText}>Loading courses...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <FlatList
                data={courses}
                renderItem={renderCourseCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <AntDesign name="inbox" size={64} color="#cbd5e1" />
                        <Text style={styles.emptyText}>No courses found</Text>
                        <Text style={styles.emptySubtext}>Connect your D2L account to see your courses</Text>
                        <TouchableOpacity
                            style={styles.connectButton}
                            onPress={() => navigation.navigate('Sync' as never)}
                        >
                            <Text style={styles.connectButtonText}>Go to Integrations</Text>
                        </TouchableOpacity>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#64748b',
    },
    listContent: {
        padding: 16,
        flexGrow: 1,
    },
    courseCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    courseIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#eef2ff',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    courseInfo: {
        flex: 1,
    },
    courseName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1e293b',
        marginBottom: 4,
    },
    courseCode: {
        fontSize: 14,
        color: '#64748b',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 80,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1e293b',
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#64748b',
        textAlign: 'center',
        marginTop: 8,
        marginBottom: 24,
    },
    connectButton: {
        backgroundColor: '#6366f1',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    connectButtonText: {
        color: '#ffffff',
        fontWeight: '600',
        fontSize: 16,
    },
});
