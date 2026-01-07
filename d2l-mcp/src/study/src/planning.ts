import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import {z} from "zod";
import { supabase } from "../../utils/supabase.js";

export const PlanningTools = {
    tasks_list: {
        description: `Retrieve a list of tasks for a specified course. Returns task title, due date, status (completed/pending), and priority. Use to answer: "What tasks do I have for this course?", "What are my upcoming deadlines?", "Which tasks are high priority?"`,
        schema: {
            taskTitle: z.string().optional().describe("Filter by task title"),
            status: z.enum(["completed", "pending"]).optional().describe("Filter by task status"),
            source: z.string().optional().describe("Filter by task source"),
            dueBefore: z.string().optional().describe("Filter tasks due before this date (ISO 8601 format)"),
        },
        handler: async (args: { taskTitle?: string; status?: "completed" | "pending"; source?: string; dueBefore?: string }): Promise<string> => {
            const taskTitle = args.taskTitle; 
            const status = args.status;
            const source = args.source;
            const dueBefore = args.dueBefore;
            
            try {
                let query = supabase
                    .from('tasks')
                    .select('*');
                
                if (taskTitle) {
                    query = query.ilike('task_title', `%${taskTitle}%`);
                }
                
                if (status) {
                    query = query.eq('status', status);
                }
                
                if (source) {
                    query = query.eq('source', source);
                }
                
                if (dueBefore) {
                    query = query.lte('due_at', dueBefore);
                }
                
                // Order by due date
                query = query.order('due_at', { ascending: true });
                
                const { data: tasks, error } = await query;
                
                if (error) {
                    console.error('[TASKS_LIST] Supabase error:', JSON.stringify(error, null, 2));
                    return `Error fetching tasks: ${error.message || JSON.stringify(error, null, 2)}`;
                }
                
                if (!tasks || tasks.length === 0) {
                    return JSON.stringify({ message: "No tasks found", tasks: [] }, null, 2);
                }
                
                return JSON.stringify(tasks, null, 2);
            } catch (error) {
                console.error('[TASKS_LIST] Exception:', error);
                if (error instanceof Error) {
                    return `Error fetching tasks: ${error.message}\nStack: ${error.stack}`;
                }
                return `Error fetching tasks: ${JSON.stringify(error, null, 2)}`;
            }
        }
    },
    tasks_complete: {
        description: `Mark a specified task as completed. Use to answer: "Mark task X as completed."`,
        schema: {
            taskId: z.string().describe("The unique identifier of the task to mark as completed"),
            taskName: z.string().optional().describe("The name of the task to mark as completed"),
        },
        handler: async (args: { taskId: string; taskName?: string }): Promise<string> => {
            const taskId = args.taskId;
            const taskName = args.taskName;

            try {
                const { data, error } = await supabase
                    .from('tasks')
                    .update({ status: 'completed' })
                    .eq('id', taskId);
                
                if (error) {
                    throw error;
                }
                
                return `Task ${taskName ? `"${taskName}" ` : ''}with ID ${taskId} marked as completed.`;
            } catch (error) {
                return `Error marking task as completed: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
    }
};